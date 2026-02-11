/**
 * Channel types for WOPR plugins.
 *
 * Channels are the communication pathways (Discord, Slack, P2P, etc.)
 * that plugins can register to send and receive messages.
 */

/**
 * Reference to a communication channel.
 */
export interface ChannelRef {
  id: string;
  type: string;
  name?: string;
}

/**
 * Adapter for a specific channel instance.
 * Plugins register these to bridge between WOPR sessions and external channels.
 */
export interface ChannelAdapter {
  channel: ChannelRef;
  session: string;
  getContext(): Promise<string>;
  send(message: string): Promise<void>;
}

/**
 * Context passed to channel command handlers.
 */
export interface ChannelCommandContext {
  channel: string;
  channelType: string;
  sender: string;
  args: string[];
  reply: (msg: string) => Promise<void>;
  getBotUsername: () => string;
}

/**
 * Context passed to channel message parsers.
 */
export interface ChannelMessageContext {
  channel: string;
  channelType: string;
  sender: string;
  content: string;
  reply: (msg: string) => Promise<void>;
  getBotUsername: () => string;
}

/**
 * A command that can be registered on channel providers.
 */
export interface ChannelCommand {
  name: string;
  description: string;
  handler: (ctx: ChannelCommandContext) => Promise<void>;
}

/**
 * A message parser that watches channel messages.
 */
export interface ChannelMessageParser {
  id: string;
  pattern: RegExp | ((msg: string) => boolean);
  handler: (ctx: ChannelMessageContext) => Promise<void>;
}

/**
 * Channel provider interface.
 *
 * Channel plugins (Discord, Slack, Telegram, etc.) implement this to
 * expose their channels to other plugins for registering protocol-level
 * commands and message parsers.
 */
export interface ChannelProvider {
  id: string;

  // Command registration
  registerCommand(cmd: ChannelCommand): void;
  unregisterCommand(name: string): void;
  getCommands(): ChannelCommand[];

  // Message watching
  addMessageParser(parser: ChannelMessageParser): void;
  removeMessageParser(id: string): void;
  getMessageParsers(): ChannelMessageParser[];

  // Send to channel
  send(channel: string, content: string): Promise<void>;

  // Bot username for this provider
  getBotUsername(): string;
}
