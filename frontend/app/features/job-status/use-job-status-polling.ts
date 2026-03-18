import { useEffect, useEffectEvent } from 'react';

import { isTerminalPrintState } from '../../lib/utils/date';

export function useJobStatusPolling(input: {
  state: string;
  onPoll: () => void;
  intervalMs?: number;
}): void {
  const onPoll = useEffectEvent(input.onPoll);

  useEffect(() => {
    if (isTerminalPrintState(input.state)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      onPoll();
    }, input.intervalMs ?? 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [input.intervalMs, input.state, onPoll]);
}
