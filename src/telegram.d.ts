export {};
declare global {
  interface Window {
    Telegram?: { WebApp: {
      initData: string;
      isActive?: boolean;
      ready(): void;
      onEvent(event: string, handler: () => void): void;
      offEvent(event: string, handler: () => void): void;
      openTelegramLink(url: string): void;
    } };
  }
}
