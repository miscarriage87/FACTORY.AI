/**
 * backend.ts
 * 
 * This file handles communication with the Tauri/Rust backend.
 * It provides a simple API for the frontend to send and receive data.
 */

// Import the invoke function from Tauri API
import { invoke } from '@tauri-apps/api/tauri';

/**
 * Sends a greeting to the Rust backend and returns the response.
 * 
 * This calls the 'greet' command defined in our Rust backend (main.rs).
 * 
 * @param name - The name to greet
 * @returns A promise that resolves to the greeting message from the backend
 */
export async function sendGreeting(name: string): Promise<string> {
  try {
    // Invoke the 'greet' command defined in Rust (main.rs)
    const response = await invoke<string>('greet', { name });
    return response;
  } catch (error) {
    console.error('Error calling Rust backend:', error);
    return `Error: Failed to send greeting to backend`;
  }
}
