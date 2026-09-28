export const label = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase();
export const date = (value: string) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
