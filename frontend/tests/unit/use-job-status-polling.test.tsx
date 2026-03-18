import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useJobStatusPolling } from '../../app/features/job-status/use-job-status-polling';

function Harness(props: { state: string; onPoll: () => void }) {
  useJobStatusPolling({
    state: props.state,
    onPoll: props.onPoll,
    intervalMs: 5000,
  });

  return null;
}

describe('useJobStatusPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('polls until the job reaches a terminal state', () => {
    const onPoll = vi.fn();
    const { rerender } = render(<Harness state="processing" onPoll={onPoll} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onPoll).toHaveBeenCalledTimes(1);

    rerender(<Harness state="printed" onPoll={onPoll} />);

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(onPoll).toHaveBeenCalledTimes(1);
  });
});
