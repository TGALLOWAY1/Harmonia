import { describe, it, expect } from "vitest";
import { mapTriadToMidi } from "../mapping";
import { buildTriadFromRoot } from "../chord";

describe("mapping", () => {
    it("mapping a triad yields unique MIDI notes within C3-B3 (48-59)", () => {
        const triad = buildTriadFromRoot("C", "maj");
        const mapped = mapTriadToMidi(triad, 3);

        // Single octave notes expected
        expect(mapped.midiNotes).toEqual([48, 52, 55]);

        // Unique notes check
        expect(new Set(mapped.midiNotes).size).toBe(3);

        // Within boundaries C3 (48) and B3 (59)
        mapped.midiNotes.forEach(note => {
            expect(note).toBeGreaterThanOrEqual(48);
            expect(note).toBeLessThanOrEqual(59);
        });
    });
});
