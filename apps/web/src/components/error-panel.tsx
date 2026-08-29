/** Inline error card for platform failures (calm, explainable, no alarm walls). */
export function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <section className="card error-panel" role="alert">
      <h2 className="card-title">{title}</h2>
      <p className="meta-line">{message}</p>
      <p className="card-note">
        Check that the platform service is running (default http://localhost:8787), then reload.
      </p>
    </section>
  );
}
