declare namespace NodeJS {
  interface ProcessEnv {
    /** Set by vite-plugin-electron while `vite` is serving the window. */
    VITE_DEV_SERVER_URL?: string
  }
}

export {}
