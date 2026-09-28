export type TicketStatus = "OPEN" | "PENDING" | "RESOLVED";
export type Priority = "LOW" | "NORMAL" | "HIGH";
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
