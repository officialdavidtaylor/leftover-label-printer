import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { PrintJobStatusResponse } from '../../lib/schemas/print-jobs';

type JobStatusState = {
  records: Record<string, PrintJobStatusResponse>;
  pollingState: 'idle' | 'polling' | 'settled';
};

const initialState: JobStatusState = {
  records: {},
  pollingState: 'idle',
};

const jobStatusSlice = createSlice({
  name: 'jobStatus',
  initialState,
  reducers: {
    jobStatusLoaded(state, action: PayloadAction<PrintJobStatusResponse>) {
      state.records[action.payload.jobId] = action.payload;
    },
    pollingStarted(state) {
      state.pollingState = 'polling';
    },
    pollingSettled(state) {
      state.pollingState = 'settled';
    },
  },
});

export const { jobStatusLoaded, pollingSettled, pollingStarted } = jobStatusSlice.actions;
export const jobStatusReducer = jobStatusSlice.reducer;
