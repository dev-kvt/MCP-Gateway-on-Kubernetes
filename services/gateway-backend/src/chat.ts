import OpenAI from 'openai';
import { upstreamManager } from './upstream-manager.js';
import { writeAuditLog } from './db.js';

const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 10;

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: LLM_API_KEY,
      baseURL: LLM_BASE_URL,
    });
  }
  return openaiClient;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

interface ToolCallRecord {
  server: string;
  tool: string;
  args: any;
  result: string;
  success: boolean;
  durationMs: number;
}

export async function handleChatRequest(
  userMessage: string,
  conversationHistory: ChatMessage[],
  user: { id: number; username: string; role: string }
): Promise<{ reply: string; toolCalls: ToolCallRecord[]; history: ChatMessage[] }> {
  if (!LLM_API_KEY) {
    return {
      reply: '⚠️ LLM is not configured. Set LLM_API_KEY (or OPENAI_API_KEY) environment variable to enable the chat agent.',
      toolCalls: [],
      history: conversationHistory,
    };
  }

  const allToolCalls: ToolCallRecord[] = [];
  const aggregatedTools = upstreamManager.getAggregatedTools();

  // Convert MCP tools to OpenAI function definitions
  const functions: OpenAI.Chat.Completions.ChatCompletionTool[] = aggregatedTools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.namespacedName,
      description: t.description,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));

  const systemPrompt = `You are a helpful assistant for a team using a WooCommerce store platform. You have access to tools from multiple connected services. When asked questions about products, orders, customers, inventory, or shipping, use the available tools to find the information. Always explain what tools you called and what the results were. The current user is "${user.username}" with role "${user.role}".`;

  // Build messages array
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id || '' };
      }
      if (m.role === 'assistant' && m.tool_calls) {
        return { role: 'assistant' as const, content: m.content || null, tool_calls: m.tool_calls };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    }),
    { role: 'user', content: userMessage },
  ];

  const updatedHistory: ChatMessage[] = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  // Tool use loop
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await getOpenAI().chat.completions.create({
      model: LLM_MODEL,
      messages,
      tools: functions.length > 0 ? functions : undefined,
      tool_choice: functions.length > 0 ? 'auto' : undefined,
    });

    const choice = completion.choices[0];
    if (!choice) break;

    const assistantMessage = choice.message;

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      // Final text response
      const reply = assistantMessage.content || '';
      updatedHistory.push({ role: 'assistant', content: reply });
      return { reply, toolCalls: allToolCalls, history: updatedHistory };
    }

    // Process tool calls
    messages.push({
      role: 'assistant',
      content: assistantMessage.content || null,
      tool_calls: assistantMessage.tool_calls,
    });

    updatedHistory.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      tool_calls: assistantMessage.tool_calls,
    });

    for (const toolCall of assistantMessage.tool_calls) {
      const fnName = toolCall.function.name;
      let args: any = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {}

      const start = Date.now();
      let resultText: string;
      let success = true;
      let serverSlug = 'unknown';
      let originalName = fnName;

      try {
        const { result, serverSlug: slug, originalName: name } = await upstreamManager.callTool(fnName, args);
        serverSlug = slug;
        originalName = name;
        resultText = result?.content
          ?.map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
          .join('\n') || JSON.stringify(result);
      } catch (err: any) {
        success = false;
        resultText = `Error: ${err.message}`;
        const parts = fnName.split('__');
        serverSlug = parts[0] || 'unknown';
        originalName = parts.slice(1).join('__') || fnName;
      }

      const durationMs = Date.now() - start;

      // Audit log under the chat user's identity
      writeAuditLog(user.id, user.username, serverSlug, originalName, durationMs, success, success ? '' : resultText);

      allToolCalls.push({
        server: serverSlug,
        tool: originalName,
        args,
        result: resultText,
        success,
        durationMs,
      });

      messages.push({
        role: 'tool',
        content: resultText,
        tool_call_id: toolCall.id,
      });

      updatedHistory.push({
        role: 'tool',
        content: resultText,
        tool_call_id: toolCall.id,
      });
    }
  }

  return {
    reply: 'I reached the maximum number of tool call rounds. Please try a simpler question.',
    toolCalls: allToolCalls,
    history: updatedHistory,
  };
}
