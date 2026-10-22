import { createContext, useCallback, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

type Entry = { value: unknown; filterKey: string };
type Entries = Record<string, Entry>;
const StoreContext = createContext<{
  entries: Entries;
  setEntries: Dispatch<SetStateAction<Entries>>;
  filterKey: string;
} | null>(null);
const ScopeContext = createContext<string[]>([]);

/** Keep only browsing state across unmounted views, for this page visit. */
export function ViewStateProvider({ filterKey, children }: { filterKey: string; children: ReactNode }) {
  const [entries, setEntries] = useState<Entries>({});
  const [generation, setGeneration] = useState({ key: filterKey, sequence: 0 });
  // Every successful change invalidates page positions, including A → B → A.
  if (generation.key !== filterKey) setGeneration({ key: filterKey, sequence: generation.sequence + 1 });
  const revision = `${generation.sequence}:${filterKey}`;
  const value = useMemo(() => ({ entries, setEntries, filterKey: revision }), [entries, revision]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function ViewStateScope({ name, children }: { name: string; children: ReactNode }) {
  const parent = useContext(ScopeContext);
  const scope = useMemo(() => [...parent, name], [parent, name]);
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

/** Without a page provider, shared tables retain their ordinary local state. */
export function useViewState<T>(key: string, initial: T | (() => T), { resetOnFilterChange = false }: { resetOnFilterChange?: boolean } = {}): [T, Dispatch<SetStateAction<T>>] {
  const store = useContext(StoreContext);
  const scope = useContext(ScopeContext);
  const [initialValue] = useState(initial);
  const [localValue, setLocalValue] = useState(initialValue);
  const scopedKey = JSON.stringify([...scope, key]);
  const filterKey = store?.filterKey ?? "";
  const setEntries = store?.setEntries;
  const entry = store?.entries[scopedKey];
  const value = store
    ? entry && (!resetOnFilterChange || entry.filterKey === filterKey) ? entry.value as T : initialValue
    : localValue;
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    if (!setEntries) { setLocalValue(action); return; }
    setEntries((previous) => {
      const saved = previous[scopedKey];
      const current = saved && (!resetOnFilterChange || saved.filterKey === filterKey) ? saved.value as T : initialValue;
      const next = typeof action === "function" ? (action as (current: T) => T)(current) : action;
      if (saved && saved.filterKey === filterKey && Object.is(current, next)) return previous;
      return { ...previous, [scopedKey]: { value: next, filterKey } };
    });
  }, [filterKey, initialValue, resetOnFilterChange, scopedKey, setEntries]);
  return [value, setValue];
}
