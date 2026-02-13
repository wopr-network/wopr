/**
 * User Auth Types (WOP-208)
 *
 * Hono environment type for JWT-authenticated routes.
 */

export type UserAuthEnv = {
  Variables: {
    userId: string;
    userEmail: string;
    userRole: string;
  };
};
