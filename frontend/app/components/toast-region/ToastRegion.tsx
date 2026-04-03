import { Link } from 'react-router';

import { toastDismissed } from '../../features/toast/toast.duck';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import styles from './ToastRegion.module.css';

export function ToastRegion() {
  const items = useAppSelector((state) => state.toast.items);
  const dispatch = useAppDispatch();

  if (items.length === 0) {
    return null;
  }

  return (
    <aside className={styles.region} aria-live="polite" data-testid="toast-region">
      {items.map((toast) => (
        <article
          key={toast.id}
          className={styles.toast}
          data-testid={toast.href ? 'submission-toast' : 'toast-card'}
        >
          <div className={styles.toast__body}>
            <p className={styles.toast__title}>{toast.title}</p>
            <p className={styles.toast__description}>{toast.description}</p>
            {toast.href ? (
              <Link
                className={styles.toast__link}
                to={toast.href}
                data-testid="toast-status-link"
              >
                {toast.linkLabel ?? 'Open'}
              </Link>
            ) : null}
          </div>
          <button
            className={styles.toast__dismiss}
            type="button"
            onClick={() => dispatch(toastDismissed({ id: toast.id }))}
            aria-label={`Dismiss ${toast.title}`}
          >
            Close
          </button>
        </article>
      ))}
    </aside>
  );
}
