/**
 * Semantic Translator Service
 * Maps low-level system signals and error codes to high-level natural language feedback.
 */
export class SemanticTranslator {
    static signalMap = {
        'SIGSYS': 'Action Denied: Your code attempted to perform a restricted system call that is not allowed in this security profile.',
        'SIGKILL': 'Process Terminated: The sandbox killed the process, possibly due to a timeout or critical violation.',
        'SIGSEGV': 'Segmentation Fault: Your code attempted to access invalid memory. This could be a bug in your code or an attempt to probe memory.',
        'OOM_KILL': 'Resource Exhausted: The process exceeded the allocated memory limit. Please optimize your memory usage.',
    };
    static errnoMap = {
        'EPERM': 'Security Violation: Operation not permitted. You are trying to access a restricted resource.',
        'EACCES': 'Permission Denied: You do not have the required permissions to access this file or directory.',
        'ENOENT': 'File Not Found: The specified file or directory does not exist within the sandbox environment.',
        'ENOTDIR': 'Not a Directory: A component of the path prefix is not a directory.',
    };
    /**
     * Translates system events into semantic feedback for the AI Agent.
     */
    translate(context) {
        const messages = [];
        if (context.signal && SemanticTranslator.signalMap[context.signal]) {
            messages.push(SemanticTranslator.signalMap[context.signal]);
        }
        if (context.errno && SemanticTranslator.errnoMap[context.errno]) {
            messages.push(SemanticTranslator.errnoMap[context.errno]);
        }
        if (context.syscall) {
            messages.push(`The violation occurred during the \`${context.syscall}\` system call.`);
        }
        if (context.path) {
            messages.push(`Affected resource path: \`${context.path}\`.`);
        }
        if (messages.length === 0) {
            return context.details || 'An unknown security or system error occurred within the sandbox.';
        }
        return messages.join(' ');
    }
}
//# sourceMappingURL=translator.js.map