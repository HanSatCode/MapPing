import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Basecamp, DayTheme, ParsedPlace } from "../types";
import type { DestinationId } from "./destinations";

interface WizardState {
  destination: DestinationId;
  rawText: string;
  days: number;
  basecamp: Basecamp | null;
  basecampUndecided: boolean;
  places: ParsedPlace[];
  dayThemes: DayTheme[];
  notes: string;
}

interface WizardContextValue extends WizardState {
  setDestination: (d: DestinationId) => void;
  setRawText: (text: string) => void;
  setDays: (days: number) => void;
  setBasecamp: (b: Basecamp | null) => void;
  setBasecampUndecided: (v: boolean) => void;
  setPlaces: (p: ParsedPlace[]) => void;
  setDayThemes: (t: DayTheme[]) => void;
  setNotes: (notes: string) => void;
  reset: () => void;
}

const initialState: WizardState = {
  destination: "fukuoka",
  rawText: "",
  days: 3,
  basecamp: null,
  basecampUndecided: false,
  places: [],
  dayThemes: [],
  notes: "",
};

const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WizardState>(initialState);

  const value = useMemo<WizardContextValue>(
    () => ({
      ...state,
      setDestination: (destination) => setState((s) => ({ ...s, destination })),
      setRawText: (rawText) => setState((s) => ({ ...s, rawText })),
      setDays: (days) => setState((s) => ({ ...s, days })),
      setBasecamp: (basecamp) => setState((s) => ({ ...s, basecamp })),
      setBasecampUndecided: (basecampUndecided) => setState((s) => ({ ...s, basecampUndecided })),
      setPlaces: (places) => setState((s) => ({ ...s, places })),
      setDayThemes: (dayThemes) => setState((s) => ({ ...s, dayThemes })),
      setNotes: (notes) => setState((s) => ({ ...s, notes })),
      reset: () => setState(initialState),
    }),
    [state]
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within WizardProvider");
  return ctx;
}
