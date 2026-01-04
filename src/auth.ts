import type { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import {
  type GoogleCredentials,
  getCredentials,
  updateCredentials,
} from "./secrets";

let oauthClient: OAuth2Client | null = null;

/**
 * Initialize and return an authenticated OAuth2 client.
 * Handles token refresh and persists new tokens to Secrets Manager.
 * This is a singleton - subsequent calls return the cached client.
 */
export async function getAuthClient(): Promise<OAuth2Client> {
  if (oauthClient) {
    return oauthClient;
  }

  const credentials = await getCredentials();

  oauthClient = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
  );

  oauthClient.setCredentials({
    refresh_token: credentials.refreshToken,
    access_token: credentials.accessToken,
    expiry_date: credentials.expiryDate,
  });

  // Handle token refresh events.
  // Persist new tokens to Secrets Manager for future lambda invocations
  oauthClient.on("tokens", async (tokens) => {
    console.log("Token refreshed, updating Secrets Manager");
    const currentCreds = await getCredentials();
    const updatedCreds: GoogleCredentials = {
      ...currentCreds,
      accessToken: tokens.access_token || currentCreds.accessToken,
      expiryDate: tokens.expiry_date || currentCreds.expiryDate,
    };
    if (tokens.refresh_token) {
      updatedCreds.refreshToken = tokens.refresh_token;
    }
    await updateCredentials(updatedCreds);
  });

  return oauthClient;
}
