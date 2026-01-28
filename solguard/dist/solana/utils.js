"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isParsedInstruction = isParsedInstruction;
/**
 * A TypeScript type guard to determine if an instruction is fully parsed.
 * @param instruction The instruction to check.
 * @returns True if the instruction has a 'parsed' property, false otherwise.
 */
function isParsedInstruction(instruction) {
    return instruction.parsed !== undefined;
}
