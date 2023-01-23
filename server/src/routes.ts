import dayjs from "dayjs";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./lib/prisma";

export async function appRoutes(app: FastifyInstance) {
  /*app.get("/habits", async (req, res) => {
    const habits = await prisma.habit.findMany();

    if (habits.length === 0) {
      return res.status(404).send({ error: "There are no habits yet." });
    }

    return res.status(200).send(habits);
  });*/

  app.post("/habits", async (req) => {
    const createHabitBody = z.object({
      title: z.string(),
      weekDays: z.array(z.number().min(0).max(6)),
    });
    const { title, weekDays } = createHabitBody.parse(req.body);
    const today = dayjs().startOf("day").toDate();

    await prisma.habit.create({
      data: {
        title,
        created_at: today,
        weekDays: {
          create: weekDays.map((weekDay) => {
            return {
              week_day: weekDay,
            };
          }),
        },
      },
    });
  });

  app.get("/day", async (req) => {
    const getDayParams = z.object({
      date: z.coerce.date(),
    });

    const { date } = getDayParams.parse(req.query);
    const parsedDate = dayjs(date).startOf("day");
    const weekDay = parsedDate.get("day");

    const possibleHabits = await prisma.habit.findMany({
      where: {
        created_at: {
          lte: date,
        },
        weekDays: {
          some: {
            week_day: weekDay,
          },
        },
      },
    });

    const day = await prisma.day.findUnique({
      where: {
        date: parsedDate.toDate(),
      },
      include: {
        dayHabits: true,
      },
    });

    const completedHabits = day?.dayHabits.map((dayHabit) => {
      return dayHabit.habit_id;
    }) ?? [];

    return {
      possibleHabits,
      completedHabits,
    };
  });

  // Mark and unmark an habit
  app.patch("/habits/:id/toggle", async (req, res) => {
    const toggleHabitParams = z.object({
      id: z.string().uuid(),
    });

    const { id } = toggleHabitParams.parse(req.params);
    const today = dayjs().startOf("day").toDate();

    let day = await prisma.day.findUnique({
      where: {
        date: today,
      },
    });

    // Create today's date if it doesn't exist
    if (!day) {
      day = await prisma.day.create({
        data: {
          date: today,
        },
      });
    }

    //Verifying if habit was marked as done in a specific day
    const dayHabit = await prisma.dayHabit.findUnique({
      where: {
        day_id_habit_id: {
          day_id: day.id,
          habit_id: id,
        },
      },
    });

    if (dayHabit) {
      await prisma.dayHabit.delete({
        where: {
          id: dayHabit.id,
        },
      });
    } else {
      // Mark as done
      await prisma.dayHabit.create({
        data: {
          day_id: day.id,
          habit_id: id,
        },
      });
    }
  });

  // Getting a summary view of the tasks
  app.get("/summary", async () => {
      const summary = await prisma.$queryRaw`
        SELECT 
          D.id, 
          D.date,
          (
            SELECT 
              cast(count(*) as float)
              FROM day_habits DH
              WHERE DH.day_id = D.id
          ) as completed,
          (
            SELECT
              cast(count(*) as float)
              FROM habit_week_days HWD
              JOIN habits H
                ON H.id = HWD.habit_id
              WHERE
                HWD.week_day = cast(strftime('%w', D.date/1000.0, 'unixepoch') as int)
                AND H.created_at <= D.date
          ) as amount
        FROM days D
      `
      return summary
  });
}
