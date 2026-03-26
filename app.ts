import express from "express";
import { endRecording, startRecording } from "./handlers.ts";

const app = express();

app.use(express.json());

app.post("/", async (req, res) => {
	const { channelInviteLink, channelType } = req.body;
	if (
		typeof channelInviteLink !== "string" ||
		(channelType !== "voice" && channelType !== "stage")
	) {
		res
			.status(400)
			.send(
				"Invalid request body, expected { channelInviteLink: string, channelType: 'voice' | 'stage' }",
			);
		return;
	}

	await startRecording(channelInviteLink, channelType).catch(() => {
		res
			.status(404)
			.send("Recording failed to start, ensure correct data was entered");
		return;
	});
	res.status(200).send("Recording started");
});

app.delete("/", async (_req, res) => {
	endRecording();
	res.status(200).send("Recording stopped");
});

app.listen(3000, () => {
	console.log("listening");
});
