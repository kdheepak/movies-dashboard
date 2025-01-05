# -*- coding: utf-8 -*-
import param as pm
import pandas as pd
import panel as pn
import holoviews as hv

pd.options.mode.copy_on_write = True
pd.options.future.no_silent_downcasting = True

pn.extension(
    "tabulator",
    sizing_mode="stretch_width",
    notifications=True,
    throttled=True,
)
hv.extension("bokeh")


@pn.cache
def get_data():
    title_basics = pd.read_csv(
        "https://datasets.imdbws.com/title.basics.tsv.gz",
        sep="\t",
        dtype={
            "tconst": "object",
            "primaryTitle": "object",
            "titleType": "object",
            "runtimeMinutes": "object",
            "startYear": "object",
        },
        usecols=[
            "tconst",
            "titleType",
            "primaryTitle",
            "runtimeMinutes",
            "startYear",
            "genres",
        ],
        na_values="\\N",
    ).query("titleType == 'movie'")
    title_ratings = pd.read_csv(
        "https://datasets.imdbws.com/title.ratings.tsv.gz",
        sep="\t",
        dtype={"tconst": "object", "averageRating": "float64", "numVotes": "int64"},
        usecols=["tconst", "averageRating", "numVotes"],
    )
    movies = title_basics.merge(title_ratings, on="tconst").dropna()
    movies["startYear"] = pd.to_numeric(movies["startYear"], downcast="integer")
    movies["runtimeMinutes"] = pd.to_numeric(movies["runtimeMinutes"], downcast="integer")
    movies["genres"] = movies["genres"].str.split(",")
    movies = movies.explode("genres")
    return movies

class Movies(pm.Parameterized):
    df = pm.DataFrame()
    filtered_df = pm.DataFrame()
    year_range = pm.Range()
    ratings_range = pm.Range()
    runtime_range = pm.Range()
    genre = pm.Selector()

    def _preprocess_data(self):
        self.df = get_data()

    @pm.depends("df", watch=True, on_init=True)
    def _update_bounds(self):
        if self.df is None:
            return

        self.param.year_range.bounds = (
            int(self.df.startYear.min()),
            int(self.df.startYear.max()),
        )
        self.year_range = (
            int(self.df.startYear.min()),
            int(self.df.startYear.max()),
        )

        self.param.ratings_range.bounds = (0, 10)
        self.ratings_range = (0, 10)

        self.param.runtime_range.bounds = (
            int(self.df.runtimeMinutes.min()),
            int(self.df.runtimeMinutes.max()),
        )

        self.runtime_range = (
            int(self.df.runtimeMinutes.min()),
            int(self.df.runtimeMinutes.max()),
        )

        self.param.genre.objects = list(self.df.genres.unique())
        self.genre = self.df.genres.unique()[0]

    @pm.depends(
        "df",
        "year_range",
        "ratings_range",
        "runtime_range",
        "genre",
        watch=True,
        on_init=True,
    )
    def _update_table(self):
        if self.year_range is None or self.ratings_range is None or self.runtime_range is None:
            return self.df
        df, year_range, ratings_range, runtime_range, genre = (
            self.df,
            self.year_range,
            self.ratings_range,
            self.runtime_range,
            self.genre,
        )
        self.filtered_df = (
            df.query(f"genres == '{genre}'")
            .query(f"startYear >= {year_range[0]}")
            .query(f"startYear <= {year_range[-1]}")
            .query(f"averageRating >= {ratings_range[0]}")
            .query(f"averageRating <= {ratings_range[-1]}")
            .query(f"runtimeMinutes >= {runtime_range[0]}")
            .query(f"runtimeMinutes <= {runtime_range[-1]}")
        )

    @pm.depends("filtered_df")
    def _update_plot(self):
        plot = hv.BoxWhisker(self.filtered_df, kdims=["startYear"], vdims=["averageRating"],).opts(
            width=900,
            height=400,
            title=f"IMDb Movies - {self.genre}",
            xlabel="Year",
            ylabel="IMDb Rating",
            ylim=(0, 10),
            xrotation=90,
        )

        return plot

    def panel(self):
        table = pn.widgets.Tabulator(
            self.param.filtered_df,
            pagination="remote",
            page_size=10,
        )
        genres = pn.widgets.Select.from_param(self.param.genre)
        plot = self._update_plot

        layout = pn.Column(
            pn.Row(
                self.param.ratings_range,
                self.param.year_range,
                self.param.runtime_range,
            ),
            pn.Row(genres),
            pn.Tabs(("Visualization", hv.DynamicMap(plot)), ("Data", table)),
        )
        return layout


app = Movies()
template = pn.template.BootstrapTemplate(
    title="Movies Dashboard",
    sidebar=pn.Card(
        pn.pane.Markdown(
            r"""
# Movies Dashboard

This panel downloads IMDb database and visualizes average rating for per genre for each year.
                                     """
        )
    ),
)
template.main.append(pn.Card(app.panel, title="Movies Dashboard"))

pn.state.onload(app._preprocess_data)

template.servable()
