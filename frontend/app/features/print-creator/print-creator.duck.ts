import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

type PrintCreatorState = {
  submissionState: 'idle' | 'submitting' | 'succeeded' | 'failed';
  lastSubmittedJobId: string | null;
  lastError: string | null;
};

const initialState: PrintCreatorState = {
  submissionState: 'idle',
  lastSubmittedJobId: null,
  lastError: null,
};

const printCreatorSlice = createSlice({
  name: 'printCreator',
  initialState,
  reducers: {
    submissionStarted(state) {
      state.submissionState = 'submitting';
      state.lastError = null;
    },
    submissionSucceeded(state, action: PayloadAction<{ jobId: string }>) {
      state.submissionState = 'succeeded';
      state.lastSubmittedJobId = action.payload.jobId;
      state.lastError = null;
    },
    submissionFailed(state, action: PayloadAction<{ message: string }>) {
      state.submissionState = 'failed';
      state.lastError = action.payload.message;
    },
    submissionReset(state) {
      state.submissionState = 'idle';
      state.lastError = null;
    },
  },
});

export const {
  submissionFailed,
  submissionReset,
  submissionStarted,
  submissionSucceeded,
} = printCreatorSlice.actions;
export const printCreatorReducer = printCreatorSlice.reducer;
