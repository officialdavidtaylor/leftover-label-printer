import { configureStore } from '@reduxjs/toolkit';

import { authReducer } from '../features/auth/auth.duck';
import { jobStatusReducer } from '../features/job-status/job-status.duck';
import { printCreatorReducer } from '../features/print-creator/print-creator.duck';
import { toastReducer } from '../features/toast/toast.duck';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    printCreator: printCreatorReducer,
    jobStatus: jobStatusReducer,
    toast: toastReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
