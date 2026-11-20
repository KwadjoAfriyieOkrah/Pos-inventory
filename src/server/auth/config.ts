import Credentials from "next-auth/providers/credentials";
import type { DefaultSession, NextAuthConfig } from "next-auth";
import { env } from "@/lib/env";
import { login } from "./login";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string;
    } & DefaultSession["user"];
  }

  interface User {
    organizationId: string;
  }
}

export const authConfig = {
  secret: env.AUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const result = await login(credentials);
        if (!result.ok) return null;

        return {
          id: result.user.id,
          organizationId: result.user.organizationId,
          email: result.user.email,
          name: result.user.fullName,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        return {
          ...token,
          sub: user.id,
          organizationId: user.organizationId,
          email: user.email,
          name: user.name,
        };
      }

      return token;
    },
    session({ session, token }) {
      if (
        typeof token.sub !== "string" ||
        typeof token.organizationId !== "string"
      ) {
        throw new Error("Authenticated session is missing identity claims.");
      }

      session.user = {
        ...session.user,
        id: token.sub,
        organizationId: token.organizationId,
        email:
          typeof token.email === "string" ? token.email : session.user.email,
        name: typeof token.name === "string" ? token.name : session.user.name,
      };

      return session;
    },
  },
} satisfies NextAuthConfig;