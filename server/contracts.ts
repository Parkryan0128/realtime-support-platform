export const statuses = ["OPEN", "PENDING", "RESOLVED"] as const;
export const priorities = ["LOW", "NORMAL", "HIGH"] as const;
export type TicketStatus = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];
export type Role = "CUSTOMER" | "AGENT" | "ADMIN";

export interface Workspace {
  id: string;
  name: string;
  role: Role;
}
export interface Me {
  user: { id: string; name: string; email: string };
  csrfToken: string;
  workspaces: Workspace[];
}
export interface Agent {
  id: string;
  name: string;
  role: Exclude<Role, "CUSTOMER">;
}
export interface TicketPatch {
  status?: TicketStatus;
  priority?: Priority;
  assigneeId?: string | null;
}
export interface Ticket {
  id: string;
  workspace_id: string;
  customer_id: string;
  customer_name: string;
  subject: string;
  priority: Priority;
  status: TicketStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  version: number;
  next_sequence: number;
  created_at: string;
  updated_at: string;
}
export interface Message {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_name: string;
  client_id: string;
  sequence: number;
  body: string;
  created_at: string;
}
export interface TicketChange {
  workspaceId: string;
  ticketId: string;
}
export interface TicketPage {
  items: Ticket[];
  hasMore: boolean;
  page: number;
}
export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
  nextCursor: number;
}
