# Context For Agents is Overrated, Context For Humans is Underrated

## Idea 1: 

Multiple chrome tabs - i forget what i was working on a while ago - i need context of what i was searching.

solution: 
segregate all tabs based on name and content - pass it through llm and make it remember the context of what i was working on. i can ask it again or just have a small one line comment that tells me about that tab or group of tabs. 
also have a little voice agent (stt) that can take in commands from me and remember what i'm working on so that my google searches and open sites don't get lost. 

now, the goal is to create a separate ui with a memory graph of each search trail (group of similar tabs and pages/searches). 
this will help the user understand what projects they are working on visually and in a simple mannner. 

this is going to be a chrome extension that will have access to all the open tabs.
i wanna use sarvam api for implementing the stt.
gemini flash for the llm. 
and https://github.com/mem0ai/mem0 for managing memory for the ai. 
it shouldn't just be an llm wrapper, i want to have some agentic ai stuff going on behind the scenes whenever required. 


first, lets implement the part where we gather all the tabs and passes them through the llm.

second, lets implement just a simple graph function which sits in a chrome extension (just to check out the html graph rendering)

third, i wanna check out how this thing integrates with the memory/context manager 

fourth, its bring it all together and make the ui better  