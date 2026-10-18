# Context For Agents is Overrated, Context For Humans is Underrated

## Idea 1: 

Dozens of chrome tabs - i forget what i was working on a while ago - i need context of what i was searching.

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



## Memory Structure Dump:

We're using mem0.ai for managing memory. 

I'll tell you my problem, i'm working on a project for a few weeks and there are tons and tons of tabs going around. i close some and then i forget which one was the one that i wanted. it's a mess strewn across multiple projects and timelines. 

I usually keep a track of the useful websites on my obsidian doc. 

but explicitly copying the links from chrome and pasting them in obsidian and writing why I need it is sorta tedious. not to mention, the switching back and forth is problematic too. I wnat it to happen seamlessly with minimal intervention. - all my tabs and context should be grouped in the browser automatically and I should be able to just give commands and stuff. 

I want a way to keep these things in the browser and have context of my own work.

each session can be grouped in terms of projects and subfolders, so we don't have to worry about timelines. although this can also be a feature - group tabs across time, but we'll see it later. 

for power users like me, i'm pretty particular about my projects and documenting them with all the links, so i won't be having a problem of duplicate projects. but say a person has similar tabs open for two different project reasons, he should have the ability to move tabs across projects seamlessly by just dragging or right clicking it in the extension. 

the memory architecture should be based on three things - projects/timeline/intent. 
1. project is self explanatory - i have a project i'm working on and tabs from similar searches get grouped together. this could happen in three ways - 
    a. user tells explicily "this is what i'm working on" and gemma 4 picks up on the intent and groups those tabs together. 
    b. if user is not working on a project, the extension suggests them possible similarities between links/tabs to group
    c. user manually clicks around and creates a project 

2. timeline is a time based memory of the links - if I ask the agent "what was i looking at last week about xyz" it should recall it based on weeks/months/ etc. 

3. intent is a meta thing which tries to gather the intent of user searches over a period of time/project. it is the underlying thing under prject and timeline. 


## Core Philosophy

When I close a group of tabs it should still be in my set of projects and i should still be able to reopen those tabs after a while. 

its essentially like having multiple conversations with your chatbot and being able to go back to the conversations after any time. 

when i click on any project or a link in our panel, it should take me to that project/link. 

also when i close all the tabs under a group in chrome, it asks me whether i want to delete the group. even if i do, that group of links should be saved under the project so that i can reopen it. 