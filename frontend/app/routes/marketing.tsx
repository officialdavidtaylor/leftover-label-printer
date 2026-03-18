import styles from './marketing.module.css';

const valueProps = [
  'Phone-first label creation that stays fast during kitchen rushes.',
  'Authenticated print jobs routed through a secure backend and edge printer flow.',
  'End-to-end job status visibility when a label is pending, printing, or failed.',
];

export default function MarketingPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.hero__copy}>
          <p className={styles.hero__eyebrow}>Kitchen reliability without the clipboard ritual</p>
          <h1 className={styles.hero__title}>Print leftover labels from your phone in a few taps.</h1>
          <p className={styles.hero__description}>
            Leftover Label Printer keeps the operator flow compact: sign in, choose the item, print,
            and keep an eye on the job status from the same PWA.
          </p>
          <div className={styles.hero__actions}>
            <a className={styles.hero__primaryAction} href="/login" data-testid="marketing-login-cta">
              Sign in to print
            </a>
            <a className={styles.hero__secondaryAction} href="#why-it-works">
              See the workflow
            </a>
          </div>
        </div>
        <aside className={styles.hero__panel} aria-label="Product overview">
          <p className={styles.hero__panelLabel}>Built for the MVP print flow</p>
          <ul className={styles.hero__panelList}>
            <li>PKCE sign-in with role-aware API requests</li>
            <li>Single-screen label creation for `label-default@v1`</li>
            <li>Status follow-up for every submitted print job</li>
          </ul>
        </aside>
      </section>

      <section className={styles.section} id="why-it-works">
        <div className={styles.section__header}>
          <p className={styles.section__eyebrow}>Why teams use it</p>
          <h2 className={styles.section__title}>Focused on secure, operational printing.</h2>
        </div>
        <div className={styles.valueGrid}>
          {valueProps.map((valueProp) => (
            <article key={valueProp} className={styles.valueGrid__card}>
              <p className={styles.valueGrid__text}>{valueProp}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
