import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { AuthSession } from '../../lib/schemas/auth';

type AuthState = {
  session: AuthSession | null;
  status: 'anonymous' | 'authenticated';
};

const initialState: AuthState = {
  session: null,
  status: 'anonymous',
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    authHydrated(state, action: PayloadAction<AuthSession>) {
      state.session = action.payload;
      state.status = 'authenticated';
    },
    authSignedOut(state) {
      state.session = null;
      state.status = 'anonymous';
    },
  },
});

export const { authHydrated, authSignedOut } = authSlice.actions;
export const authReducer = authSlice.reducer;
