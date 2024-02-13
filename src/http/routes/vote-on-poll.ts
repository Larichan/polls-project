import z from "zod"
import { prisma } from "../../lib/prisma"
import { FastifyInstance } from "fastify"
import { randomUUID } from 'node:crypto'
import { redis } from "../../lib/redis"
import { voting } from "../../utils/voting-pub-sub"

const COOKIE_EXPIRATION_TIME = 60 * 60 * 24 * 30 //in seconds

export async function voteOnPoll(app : FastifyInstance) {
    app.post('/polls/:pollId/vote', async (request, reply) => {
        const voteOnPollParams = z.object({
            pollId: z.string().uuid()
        })
        
        const voteOnPollBody = z.object({
            pollOptionId: z.string().uuid()
        })
    
        const { pollId } = voteOnPollParams.parse(request.params)
        const { pollOptionId } = voteOnPollBody.parse(request.body)
    
        let { sessionId } = request.cookies

        if(sessionId) {
            const userPreviousVoteOnPoll = await prisma.vote.findUnique({
               where: {
                sessionId_pollId: {
                    sessionId,
                    pollId
                }
               }
            })

            if(userPreviousVoteOnPoll) {
                if(userPreviousVoteOnPoll.pollOptionId !== pollOptionId) {
                    await prisma.vote.delete({
                        where: {
                            id : userPreviousVoteOnPoll.id
                        }
                    })

                    const votes = await redis.zincrby(pollId, -1, userPreviousVoteOnPoll.pollOptionId)
                    voting.publish(pollId, {
                        pollOptionId: userPreviousVoteOnPoll.pollOptionId,
                        votes: Number(votes)
                    })
                } else {
                    return reply.status(400).send({ message: "Usuário já votou nessa enquete" })
                }
            }
        } else {
            sessionId = randomUUID()
    
            reply.setCookie('sessionId', sessionId, {
                path: '/',
                maxAge: COOKIE_EXPIRATION_TIME,
                signed: true,
                httpOnly: true
            })
        }

        await prisma.vote.create({
            data: {
                sessionId,
                pollId,
                pollOptionId
            }
        })

        const votes = await redis.zincrby(pollId, 1, pollOptionId)
        
        voting.publish(pollId, {
            pollOptionId,
            votes: Number(votes)
        })

        return reply.status(201).send()
    })
}