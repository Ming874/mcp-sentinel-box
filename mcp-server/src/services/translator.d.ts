/**
 * Semantic Translator Service
 * Maps low-level system signals and error codes to high-level natural language feedback.
 */
export type SystemSignal = 'SIGSYS' | 'SIGKILL' | 'SIGSEGV' | 'OOM_KILL' | string;
export type Errno = 'EPERM' | 'EACCES' | 'ENOENT' | 'ENOTDIR' | string;
export interface TranslationContext {
    signal?: SystemSignal;
    errno?: Errno;
    syscall?: string;
    path?: string;
    details?: string;
}
export declare class SemanticTranslator {
    private static readonly signalMap;
    private static readonly errnoMap;
    /**
     * Translates system events into semantic feedback for the AI Agent.
     */
    translate(context: TranslationContext): string;
}
//# sourceMappingURL=translator.d.ts.map