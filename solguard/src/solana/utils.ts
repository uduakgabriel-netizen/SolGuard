// src/solana/utils.ts
import { ParsedInstruction, PartiallyDecodedInstruction, CompiledInstruction } from '@solana/web3.js';

/**
 * A broad type representing any possible instruction format returned by getParsedTransaction.
 */
export type AnyInstruction = ParsedInstruction | PartiallyDecodedInstruction | CompiledInstruction;

/**
 * A TypeScript type guard to determine if an instruction is fully parsed.
 * @param instruction The instruction to check.
 * @returns True if the instruction has a 'parsed' property, false otherwise.
 */
export function isParsedInstruction(instruction: AnyInstruction): instruction is ParsedInstruction {
  return (instruction as ParsedInstruction).parsed !== undefined;
}
