import express from "express";
import { displayRecordings, endRecording, startRecording } from "./handlers.ts";

const app = express();

app.use(express.json());

app.get("/", async (_req, res) => {
	res.status(200).send(displayRecordings());
});

app.post("/", async (req, res) => {
	const { channelInviteLink, channelType, sendMessages, streamer } = req.body;
	if (
		typeof channelInviteLink !== "string" ||
		(channelType !== "voice" && channelType !== "stage")
	) {
		res
			.status(400)
			.send(
				"Invalid request body, expected { channelInviteLink: string, channelType: 'voice' | 'stage', streamer?: string, sendMessages?: boolean }",
			);
		return;
	}

	try {
		await startRecording(
			channelInviteLink,
			channelType,
			sendMessages,
			streamer,
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

app.listen(3000, () => {
	console.log("listening");
});
