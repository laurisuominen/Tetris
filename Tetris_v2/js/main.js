/**
 * Composition root. This is the only module allowed to wire impure things
 * together — storage, palette, renderer, audio, input, engine, UI — and it
 * holds no game logic of its own.
 *
 * Dependency direction is strictly one-way:
 *   core <- engine <- main -> { render, input, audio, ui, storage }
 * Nothing in core/ imports from any other top-level directory.
 */

// Wiring lands once the core and engine modules exist.
