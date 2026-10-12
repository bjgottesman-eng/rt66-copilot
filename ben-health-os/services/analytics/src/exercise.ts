/** Shared workout categorisation used by every connector mapper. */
export type WorkoutCategory = 'CARDIO' | 'RESISTANCE' | 'MOBILITY' | 'SPORT' | 'OTHER';

export function categorizeExercise(name: string | null | undefined): WorkoutCategory {
  if (!name) return 'OTHER';
  const n = name.toUpperCase();
  if (/STRENGTH|WEIGHT|CALISTHENICS|RESISTANCE|CROSSFIT|LIFT/.test(n)) return 'RESISTANCE';
  if (/RUN|WALK|BIK|CYCL|SWIM|ROW|ELLIPTICAL|HIK|STAIR|HIGH_INTENSITY|HIIT|TREADMILL|SKI|SKAT|WHEELCHAIR|JOG|CARDIO|INTERVAL/.test(n)) return 'CARDIO';
  if (/YOGA|PILATES|STRETCH|MOBILITY|BREATH|MEDITAT/.test(n)) return 'MOBILITY';
  if (/BASKETBALL|SOCCER|FOOTBALL|TENNIS|GOLF|BADMINTON|BASEBALL|HOCKEY|RUGBY|VOLLEYBALL|SQUASH|RACQUET|PADDLE|PICKLEBALL|MARTIAL|BOXING|CLIMB|SURF|SAIL/.test(n)) return 'SPORT';
  return 'OTHER';
}
