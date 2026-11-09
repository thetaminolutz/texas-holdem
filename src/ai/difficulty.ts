export type Difficulty = 'beginner' | 'easy' | 'medium' | 'hard' | 'expert';
export type DifficultyChoice = Difficulty | 'adaptive' | 'mixed';
export const DIFFICULTIES: Difficulty[] = ['beginner', 'easy', 'medium', 'hard', 'expert'];
export const DIFFICULTY_OPTIONS: { value: string; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'expert', label: 'Expert' },
  { value: 'adaptive', label: 'Adaptive' },
  { value: 'mixed', label: 'Mixed' },
];
