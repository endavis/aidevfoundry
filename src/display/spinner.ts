import { createSpinner } from 'nanospinner';

export function createTaskSpinner(text: string) {
  return createSpinner(text, {
    color: 'cyan',
  });
}

export async function withSpinner<T>(
  text: string,
  task: () => Promise<T>,
  successText?: string,
  errorText?: string
): Promise<T> {
  const spinner = createTaskSpinner(text);
  spinner.start();

  try {
    const result = await task();
    spinner.success({ text: successText || text });
    return result;
  } catch (error) {
    spinner.error({ text: errorText || `Failed: ${text}` });
    throw error;
  }
}
