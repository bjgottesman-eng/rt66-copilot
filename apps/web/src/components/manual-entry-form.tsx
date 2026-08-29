'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { Arm, BodyPosition, BpReadingDto, ManualBpEntry } from '@benhealth/shared';
import { useRouter } from 'next/navigation';
import { apiPost, ApiRequestError } from '@/lib/client-api';

/** Local "YYYY-MM-DDTHH:mm" for a datetime-local input. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ManualEntryForm() {
  const router = useRouter();
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [measuredAt, setMeasuredAt] = useState('');
  const [arm, setArm] = useState<Arm>('unknown');
  const [bodyPosition, setBodyPosition] = useState<BodyPosition>('unknown');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Default the timestamp after mount (avoids SSR/client clock mismatch).
  useEffect(() => {
    setMeasuredAt((current) => (current === '' ? toLocalInputValue(new Date()) : current));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const measured = new Date(measuredAt);
      if (Number.isNaN(measured.getTime())) {
        setMessage({ kind: 'err', text: 'Enter a valid measurement time.' });
        setBusy(false);
        return;
      }
      const entry: ManualBpEntry = {
        systolic: Number(systolic),
        diastolic: Number(diastolic),
        pulse: pulse === '' ? null : Number(pulse),
        measuredAt: measured.toISOString(),
        measuredTz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
        arm,
        bodyPosition,
        note: note.trim() === '' ? null : note.trim(),
      };
      await apiPost<{ reading: BpReadingDto }>('/bp/manual', entry);
      setMessage({ kind: 'ok', text: 'Reading saved.' });
      setSystolic('');
      setDiastolic('');
      setPulse('');
      setNote('');
      setMeasuredAt(toLocalInputValue(new Date()));
      router.refresh();
    } catch (err) {
      setMessage({
        kind: 'err',
        text: err instanceof ApiRequestError ? err.message : 'Could not save the reading.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="manual-title">
      <h2 className="card-title" id="manual-title">
        Add manual reading
      </h2>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="m-sys">Systolic (mmHg)</label>
            <input
              id="m-sys"
              type="number"
              inputMode="numeric"
              min={40}
              max={300}
              required
              value={systolic}
              onChange={(e) => setSystolic(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="m-dia">Diastolic (mmHg)</label>
            <input
              id="m-dia"
              type="number"
              inputMode="numeric"
              min={20}
              max={200}
              required
              value={diastolic}
              onChange={(e) => setDiastolic(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="m-pulse">Pulse (bpm, optional)</label>
            <input
              id="m-pulse"
              type="number"
              inputMode="numeric"
              min={20}
              max={250}
              value={pulse}
              onChange={(e) => setPulse(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="m-time">Measured at</label>
            <input
              id="m-time"
              type="datetime-local"
              required
              value={measuredAt}
              onChange={(e) => setMeasuredAt(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="m-arm">Arm</label>
            <select id="m-arm" value={arm} onChange={(e) => setArm(e.target.value as Arm)}>
              <option value="unknown">Not recorded</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-pos">Position</label>
            <select
              id="m-pos"
              value={bodyPosition}
              onChange={(e) => setBodyPosition(e.target.value as BodyPosition)}
            >
              <option value="unknown">Not recorded</option>
              <option value="seated">Seated</option>
              <option value="standing">Standing</option>
              <option value="lying">Lying</option>
            </select>
          </div>
          <div className="field field-wide">
            <label htmlFor="m-note">Note (optional)</label>
            <input
              id="m-note"
              type="text"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save reading'}
          </button>
        </div>
        {message !== null ? (
          <p
            className={`form-msg ${message.kind === 'ok' ? 'form-msg-ok' : 'form-msg-err'}`}
            role="status"
          >
            {message.text}
          </p>
        ) : null}
      </form>
    </section>
  );
}
