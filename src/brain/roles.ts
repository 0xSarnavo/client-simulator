/**
 * What a brain is being used for. Decides which tools it is allowed, since a
 * persona pretending to be a naive visitor must not be able to shell out or
 * fetch the page directly, while the expert panel legitimately needs both.
 */
export type BrainRole = "persona" | "expert";
