export const serverTimeZone = "Asia/Manila";
export const sqliteNow = "datetime('now','localtime')";

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}

export function serverTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-PH", {
    timeZone: serverTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(value.hour) % 24;
  return `${value.year}-${value.month}-${value.day} ${twoDigits(hour)}:${value.minute}:${value.second}`;
}
