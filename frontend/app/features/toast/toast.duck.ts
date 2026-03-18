import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ToastTone = 'info' | 'success' | 'danger';

export type ToastRecord = {
  id: string;
  title: string;
  description: string;
  tone: ToastTone;
  href?: string;
  linkLabel?: string;
};

type ToastState = {
  items: ToastRecord[];
};

const initialState: ToastState = {
  items: [],
};

const toastSlice = createSlice({
  name: 'toast',
  initialState,
  reducers: {
    toastQueued(state, action: PayloadAction<ToastRecord>) {
      state.items = [action.payload, ...state.items].slice(0, 4);
    },
    toastDismissed(state, action: PayloadAction<{ id: string }>) {
      state.items = state.items.filter((toast) => toast.id !== action.payload.id);
    },
  },
});

export const { toastDismissed, toastQueued } = toastSlice.actions;
export const toastReducer = toastSlice.reducer;
