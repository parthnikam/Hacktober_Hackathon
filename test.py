from transformers import AutoProcessor, AutoModelForMultimodalLM


def main() -> None:
    prompt = input("Enter your prompt: ").strip()
    if not prompt:
        raise ValueError("Prompt cannot be empty.")

    model_id = "google/gemma-4-E4B-it"
    processor = AutoProcessor.from_pretrained(model_id)
    model = AutoModelForMultimodalLM.from_pretrained(model_id, device_map="auto")

    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
    inputs = processor.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
    ).to(model.device)

    input_length = inputs["input_ids"].shape[-1]
    generated = model.generate(**inputs, max_new_tokens=256)
    response = processor.decode(
        generated[0][input_length:],
        skip_special_tokens=True,
    )
    print(f"\nModel response:\n{response}")


if __name__ == "__main__":
    main()
