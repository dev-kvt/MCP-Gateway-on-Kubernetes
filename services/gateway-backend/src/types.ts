// ── Shared type definitions for the gateway backend ──────────────────
import type { Request } from 'express';

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'member';
  created_at: string;
}

export interface ApiKey {
  id: number;
  user_id: number;
  key_hash: string;
  key_prefix: string;
  label: string;
  revoked: number;
  created_at: string;
}

export interface UpstreamServer {
  id: number;
  name: string;
  slug: string;
  url: string;
  auth_type: 'none' | 'bearer' | 'header';
  auth_header_name: string;
  auth_credential: string;
  enabled: number;
  status: string;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  user_id: number;
  username: string;
  server_slug: string;
  tool_name: string;
  duration_ms: number;
  success: number;
  error_message: string;
  created_at: string;
}

export interface NamespacedTool {
  serverSlug: string;
  originalName: string;
  namespacedName: string;
  description: string;
  inputSchema: any;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
    role: 'admin' | 'member';
  };
}
