import {
  AIChatMessage,
  BaseChatMessage,
  BasePromptValue,
  ChatGeneration,
  ChatResult,
  HumanChatMessage,
  LLMResult,
  RUN_KEY,
} from "../schema/index.js";
import {
  BaseLanguageModel,
  BaseLanguageModelCallOptions,
  BaseLanguageModelParams,
} from "../base_language/index.js";
import {
  CallbackManager,
  CallbackManagerForLLMRun,
  Callbacks,
} from "../callbacks/manager.js";

export type SerializedChatModel = {
  _model: string;
  _type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} & Record<string, any>;

// todo?
export type SerializedLLM = {
  _model: string;
  _type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} & Record<string, any>;

export type BaseChatModelParams = BaseLanguageModelParams;

export type BaseChatModelCallOptions = BaseLanguageModelCallOptions;

export abstract class BaseChatModel extends BaseLanguageModel {
  declare CallOptions: BaseChatModelCallOptions;

  declare ParsedCallOptions: Omit<this["CallOptions"], "timeout">;

  lc_namespace = ["langchain", "chat_models", this._llmType()];

  constructor(fields: BaseChatModelParams) {
    super(fields);
  }

  abstract _combineLLMOutput?(
    ...llmOutputs: LLMResult["llmOutput"][]
  ): LLMResult["llmOutput"];

  async generate(
    messages: BaseChatMessage[][],
    options?: string[] | this["CallOptions"],
    callbacks?: Callbacks
  ): Promise<LLMResult> {
    // parse call options
    let parsedOptions: this["CallOptions"];
    if (Array.isArray(options)) {
      parsedOptions = { stop: options } as this["CallOptions"];
    } else if (options?.timeout && !options.signal) {
      parsedOptions = {
        ...options,
        signal: AbortSignal.timeout(options.timeout),
      };
    } else {
      parsedOptions = options ?? {};
    }
    // create callback manager and start run
    const callbackManager_ = await CallbackManager.configure(
      callbacks,
      this.callbacks,
      parsedOptions.tags,
      this.tags,
      { verbose: this.verbose }
    );
    const extra = {
      options: parsedOptions,
      invocation_params: this?.invocationParams(parsedOptions),
    };
    const runManagers = await callbackManager_?.handleChatModelStart(
      this.toJSON(),
      messages,
      undefined,
      undefined,
      extra
    );
    // generate results
    const results = await Promise.allSettled(
      messages.map((messageList, i) =>
        this._generate(
          messageList,
          { ...parsedOptions, promptIndex: i },
          runManagers?.[i]
        )
      )
    );
    // handle results
    const generations: ChatGeneration[][] = [];
    const llmOutputs: LLMResult["llmOutput"][] = [];
    await Promise.all(
      results.map(async (pResult, i) => {
        if (pResult.status === "fulfilled") {
          const result = pResult.value;
          generations[i] = result.generations;
          llmOutputs[i] = result.llmOutput;
          return runManagers?.[i]?.handleLLMEnd({
            generations: [result.generations],
            llmOutput: result.llmOutput,
          });
        } else {
          // status === "rejected"
          await runManagers?.[i]?.handleLLMError(pResult.reason);
          return Promise.reject(pResult.reason);
        }
      })
    );
    // create combined output
    const output: LLMResult = {
      generations,
      llmOutput: llmOutputs.length
        ? this._combineLLMOutput?.(...llmOutputs)
        : undefined,
    };
    Object.defineProperty(output, RUN_KEY, {
      value: runManagers
        ? { runIds: runManagers?.map((manager) => manager.runId) }
        : undefined,
      configurable: true,
    });
    return output;
  }

  /**
   * Get the parameters used to invoke the model
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invocationParams(_options?: this["ParsedCallOptions"]): any {
    return {};
  }

  _modelType(): string {
    return "base_chat_model" as const;
  }

  abstract _llmType(): string;

  async generatePrompt(
    promptValues: BasePromptValue[],
    options?: string[] | this["CallOptions"],
    callbacks?: Callbacks
  ): Promise<LLMResult> {
    const promptMessages: BaseChatMessage[][] = promptValues.map(
      (promptValue) => promptValue.toChatMessages()
    );
    return this.generate(promptMessages, options, callbacks);
  }

  abstract _generate(
    messages: BaseChatMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult>;

  async call(
    messages: BaseChatMessage[],
    options?: string[] | this["CallOptions"],
    callbacks?: Callbacks
  ): Promise<BaseChatMessage> {
    const result = await this.generate([messages], options, callbacks);
    const generations = result.generations as ChatGeneration[][];
    return generations[0][0].message;
  }

  async callPrompt(
    promptValue: BasePromptValue,
    options?: string[] | this["CallOptions"],
    callbacks?: Callbacks
  ): Promise<BaseChatMessage> {
    const promptMessages: BaseChatMessage[] = promptValue.toChatMessages();
    return this.call(promptMessages, options, callbacks);
  }

  async predictMessages(
    messages: BaseChatMessage[],
    options?: string[] | this["CallOptions"],
    callbacks?: Callbacks
  ): Promise<BaseChatMessage> {
    return this.call(messages, options, callbacks);
  }

  async predict(
    text: string,
    options?: string[] | this["CallOptions"],
    callbacks?: Callbacks
  ): Promise<string> {
    const message = new HumanChatMessage(text);
    const result = await this.call([message], options, callbacks);
    return result.text;
  }
}

export abstract class SimpleChatModel extends BaseChatModel {
  abstract _call(
    messages: BaseChatMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<string>;

  async _generate(
    messages: BaseChatMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const text = await this._call(messages, options, runManager);
    const message = new AIChatMessage(text);
    return {
      generations: [
        {
          text: message.text,
          message,
        },
      ],
    };
  }
}
