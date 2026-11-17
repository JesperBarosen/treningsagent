import { startMockAuth, stopMockAuth } from "./mock-auth";

// Starts the mock auth server before the layout check and returns its teardown.
export default async function globalSetup() {
  await startMockAuth();
  return stopMockAuth;
}
