export function todayIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function isTerminalPrintState(state: string): boolean {
  return state === 'printed' || state === 'failed';
}
