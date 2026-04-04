# **Re**(*dis*)**cord**
## Windows version

***record disc***ord (get the name) voice and stage channels! 

use cases:
- recording uh music
- karaoke idk
- recording study sessions
- teaching classes ...on discord

## Prerequisites:
- `npm`
- VoiceMeeter, a similar virtual audio input/output software, or maybe just an audio output you can't hear![^1]

## Usage:

### USE AT YOUR OWN RISK
> [!CAUTION]
> *discord has asked me to verify my account with a phone number while i was testing (running a lot of recordings in quick succession, but could happen to your account too)*

download/git clone this repo, navigate into the folder, right click > open in terminal

run `npm i` to install all dependencies

then run `rediscord init <token>` with a spare alt's discord token (DO NOT USE YOUR MAIN unless you're fine w it possibly getting banned #YOLO amirite)

##

### NOW BEFORE DOING ANYTHING DO THE FOLLOWING IF YOU DONT WANT TO GO DEAF[^1]:
- run `rediscord test` - this will start playing a *familiar* song
- open volume mixer (System > Sound > Volume mixer)
- look for chrome-headless-shell.exe
- click the dropdown and change output device from default to an output you cannot hear (virtual VoiceMeeter output, monitor output that doesn't actually work, etc.)
- ensure you CANNOT hear the song while the .exe still exists or else you will go deaf when you actually record

now (not 100% needed but recommended):
- run `rediscord test -d` - this will start a chrome instance playing that familiar song again :D
- do the same steps as above but for Google Chrome for Testing

##

now you can run `rediscord start-server` creating the server instance, on which you can do the following:

- GET to display ongoing recordings
- POST with channelInviteLink to start recording
- DELETE with channelInviteLink to stop recording

instead of cURL-ing your way into recording, you can use the built in rediscord cli commands instead:

| Command | Arguments | Description |
| :--- | :--- | :--- |
| `init` | `[options] <token>` | initialize `.env` variables |
| `start-server` | - | starts the local server |
| `stop-server` | - | stops the local server |
| `test` | `[options]` | launches headless chrome for *a while* (wink) so that you can make sure it doesn't make any noise |
| `start-recording` | `[options] <channelInviteLink>` | start recording a voice/stage channel `(channelInviteLink: "https://discord.gg/{code thingy})` |
| `stop-recording` | `<channelInviteLink>` | stops the specified recording |
| `display` | - | displays ongoing recordings |
| `merge` | `[options] <filePath>` | merges and synchronizes raw video + audio files if stopped abruptly (ensure audio and video end at the same absolute time), do not include file extension in filePath (eg. raw/video instead of raw/video.mp4) |
| `help` | `[command]` | use this to get the `[options]` and more info about a command


[^1]: YOU NEED TO DO THE VIRTUAL OUTPUT THINGY BECAUSE IT PLAYS A REALLY HIGH FREQUENCY + LOUD BEEP TO SYNCHRONIZE AT THE START and i care about your ears ❤️‍🩹