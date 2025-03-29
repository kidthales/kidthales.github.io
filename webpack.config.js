const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { resolve } = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = async (env, args) => {
  const mode = args.mode || 'production';
  const isProd = mode === 'production';
  const isDevServer = env.WEBPACK_SERVE || false;

  const distPath = resolve(__dirname, 'dist');

  return {
    devtool: isProd ? false : 'eval-source-map',
    entry: resolve(__dirname, 'src', 'app.ts'),
    output: {
      path: distPath,
      filename: `_build/[name]${isProd ? '.min' : ''}.js`,
      chunkFilename: '_build/chunks/[id].[contenthash].js',
      assetModuleFilename: '_build/asset-modules/[hash][ext][query]'
    },
    optimization: isProd
      ? {
          minimizer: [
            new TerserPlugin({
              terserOptions: {}
            })
          ],
          splitChunks: {
            chunks: 'all'
          }
        }
      : undefined,
    resolve: {
      extensions: ['.ts', '.js', '.json']
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          loader: 'babel-loader'
        },
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          loader: 'ts-loader'
        },
        {
          test: /\.s[ac]ss$/i,
          use: [
            isProd ? MiniCssExtractPlugin.loader : 'style-loader',
            {
              loader: 'css-loader',
              options: {
                sourceMap: !isProd
              }
            },
            {
              loader: 'sass-loader',
              options: {
                sourceMap: !isProd,
                sassOptions: {
                  quietDeps: true
                }
              }
            }
          ]
        },
        {
          test: /\.ejs$/i,
          use: ['html-loader', 'template-ejs-loader']
        },
        {
          test: /\.html$/i,
          use: ['html-loader']
        },
        {
          test: /\.(gif|png|jpe?g|svg|xml|glsl|woff|woff2|eot|ttf|otf)$/i,
          type: 'asset/resource'
        }
      ]
    },
    plugins: [
      !isDevServer ? new CleanWebpackPlugin({ cleanOnceBeforeBuildPatterns: ['**/*'] }) : undefined,
      isProd
        ? new MiniCssExtractPlugin({
            filename: `_build/[name].min.css`,
            chunkFilename: `_build/chunks/[id].[contenthash].css`
          })
        : undefined,
      !isDevServer
        ? new CopyPlugin({
            patterns: [{ from: 'content/assets', to: 'assets' }]
          })
        : undefined,
      new HtmlWebpackPlugin({
        filename: 'index.html',
        template: resolve(__dirname, 'content', 'index.ejs')
      }),
      new HtmlWebpackPlugin({
        filename: '404.html',
        template: resolve(__dirname, 'content', '404.ejs'),
        meta: { robots: 'noindex' }
      })
    ].filter(Boolean),
    devServer: {
      client: {
        overlay: {
          warnings: false
        }
      },
      hot: false,
      port: 4200,
      static: {
        directory: resolve(__dirname, 'content')
      }
    }
  };
};
