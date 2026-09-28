import type { Message, Ticket, TicketStatus } from "../server/contracts.js";
export interface Workspace {
  id: string;
  name: string;
  role: "CUSTOMER" | "AGENT" | "ADMIN";
}
export interface Me {
  user: { id: string; name: string; email: string };
  csrfToken: string;
  workspaces: Workspace[];
}
export interface Page {
  items: Ticket[];
  hasMore: boolean;
  page: number;
}
export interface History {
  messages: Message[];
  hasMore: boolean;
  nextCursor: number;
}
export const statuses: TicketStatus[] = ["OPEN", "PENDING", "RESOLVED"];
export const label = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase();
export const date = (value: string) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
