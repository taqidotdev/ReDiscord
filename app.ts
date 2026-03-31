import fs from "node:fs"
import express from "express";
import "dotenv/config"
import { displayRecordings, endRecording, startRecording } from "./handlers.ts";

const app = express();

app.use(express.json());

app.get("/", async (_req, res) => {
	res.status(200).send({response: displayRecordings()});
});

app.post("/", async (req, res) => {
	const { channelInviteLink, channelType, sendMessages, streamer, fileName } = req.body;
	if (
		typeof channelInviteLink !== "string" ||
		(channelType !== "voice" && channelType !== "stage")
	) {
		res
			.status(400)
			.send(
				"Invalid request body, expected { channelInviteLink: string, channelType: 'voice' | 'stage', streamer?: string, sendMessages?: boolean, fileName?: string }",
			);
		return;
	}

	if (!channelInviteLink.includes("discord")) {
		res.status(400).send("Discord invite link not provided");
	}

	try {
		await startRecording(
			channelInviteLink,
			channelType,
			sendMessages,
			streamer,
			fileName
		);
	} catch (e) {
		res
			.status(400)
			.send(
				`Recording failed to start, ensure correct data was entered. Error: ${e}`,
			);
		return;
	}
	res
		.status(200)
		.send(
			"Recording started, use DELETE with the invite link to stop recording",
		);
});

app.delete("/", async (req, res) => {
	const { channelInviteLink } = req.body;

	if (!channelInviteLink) {
		res
			.status(400)
			.send(
				"Valid invite link not provided, use GET to display ongoing recordings",
			);
	}

	try {
		endRecording(channelInviteLink);
	} catch (e) {
		res.status(400).send(`Error occured while stopping recording: ${e}`);
		return;
	}
	res.status(200).send("Recording stopped");
});

app.listen(process.env.PORT, () => {
});

fs.writeFileSync(".pid", process.pid.toString());