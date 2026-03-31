import fs from "node:fs"
import express from "express";
import "dotenv/config"
import {
	displayRecordings,
	endRecording,
	interruptRecording,
	startRecording,
} from "./handlers.ts";

const app = express();

app.use(express.json());

app.get("/", async (_req, res) => {
	try {
		res.status(200).send({ response: displayRecordings() });
	} catch (e) {
		if (e instanceof Error)
			res.status(400).send({ response: `error occured: ${e.message}` });
	}
});

app.post("/", async (req, res) => {
	try {
		const { channelInviteLink, channelType, sendMessages, streamer, fileName } =
			req.body;
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
			return;
		}

		startRecording(
			channelInviteLink,
			channelType,
			sendMessages,
			streamer,
			fileName,
		).catch((e) =>
			res
				.status(400)
				.send(
					`Recording failed to start, ensure correct data was entered. Error: ${e}`,
				),
		);
		res
			.status(200)
			.send(
				"Recording starting, use DELETE <inviteLink> /interrupt if the recording doesn't start properly to terminate, use DELETE <inviteLink> after the recording to stop recording",
			);
	} catch (e) {
		if (e instanceof Error)
			res.status(400).send({ response: `error occured: ${e.message}` });
	}
});

app.delete("/", async (req, res) => {
	try {
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
	} catch (e) {
		if (e instanceof Error)
			res.status(400).send({ response: `error occured: ${e.message}` });
	}
});

app.delete("/interrupt", async (req, res) => {
	try {
		const { channelInviteLink } = req.body;

		if (!channelInviteLink) {
			res.status(400).send("Valid invite link not provided");
		}

		try {
			interruptRecording(channelInviteLink);
		} catch (e) {
			res.status(400).send(`Error occured while interrupting recording: ${e}`);
			return;
		}
		res.status(200).send("Recording interrupted");
	} catch (e) {
		if (e instanceof Error)
			res.status(400).send({ response: `error occured: ${e.message}` });
	}
});

app.listen(process.env.PORT, () => {
});

fs.writeFileSync(".pid", process.pid.toString());