import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * Estado editable que se reinicia cuando cambia `key` (p. ej. llegó un dato nuevo del servidor).
 * Usa el patrón de React de ajustar estado durante el render en vez de un efecto, que causaría un render extra.
 */
export function useSyncedState<T>(initial: () => T, key: string): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial);
  const [prev, setPrev] = useState(key);
  if (prev !== key) { setPrev(key); setState(initial()); }
  return [state, setState];
}
